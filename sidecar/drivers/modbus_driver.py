import logging
from pymodbus.client import ModbusSerialClient
from pymodbus.exceptions import ModbusException

# 로깅 설정 (디버깅용)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ModbusDriver:
    def __init__(self, port: str, config: dict):
        """
        :param port: 사용자가 선택한 시리얼 포트 (예: '/dev/ttyUSB0')
        :param config: aset_parser가 생성한 브랜드별 JSON 데이터
        """
        self.port = port
        self.config = config
        self.client = None
        self.is_connected = False

    def connect(self) -> bool:
        """JSON 설정에 따라 기계와 Handshake 시도"""
        conn_params = self.config.get("connection", {})

        self.client = ModbusSerialClient(
            port=self.port,
            baudrate=conn_params.get("baudrate", 9600),
            parity=conn_params.get("parity", "N"),
            stopbits=conn_params.get("stopbits", 1),
            bytesize=8,
            timeout=conn_params.get("timeout", 1),
        )

        self.is_connected = self.client.connect()
        if self.is_connected:
            logger.info(f"✅ [{self.config['name']}] 연결 성공 (Port: {self.port})")
        else:
            logger.error(f"❌ [{self.config['name']}] 연결 실패")

        return self.is_connected

    def read_channels(self) -> dict:
        """설정된 모든 채널(BT, ET 등)의 데이터를 한 번에 읽음"""
        if not self.is_connected:
            return {}

        results = {}
        for ch_name, ch_conf in self.config.get("channels", {}).items():
            try:
                # 1. 기계로부터 레지스터 값 읽기
                # function_code가 4면 input, 3이면 holding 등을 호출하도록 확장 가능
                response = self.client.read_input_registers(
                    address=ch_conf["register"], count=1, slave=ch_conf["slave"]
                )

                if response.isError():
                    logger.warning(f"⚠️ {ch_name} 채널 읽기 실패")
                    results[ch_name] = None
                    continue

                # 2. 데이터 가공 (Scale 적용)
                raw_value = response.registers[0]
                actual_value = round(raw_value * ch_conf.get("scale", 0.1), 2)
                results[ch_name] = actual_value

            except ModbusException as e:
                logger.error(f"❗ {ch_name} 통신 에러: {e}")
                results[ch_name] = None

        return results

    def disconnect(self):
        if self.client:
            self.client.close()
            self.is_connected = False
            logger.info("🔌 연결 해제 완료")
