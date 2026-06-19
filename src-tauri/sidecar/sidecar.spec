# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_dynamic_libs

datas = []
binaries = []
hiddenimports = []

for pkg in ('aiohttp', 'multidict', 'yarl', 'aiosignal', 'frozenlist',
            'bleak', 'pymodbus', 'websockets', 'Phidget22'):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

# snap7: python-snap7 wheel은 snap7.dll/libsnap7.so를 패키지 내부에 동봉한다.
# pyinstaller-hooks-contrib의 훅 버전에 따라 자동 수집이 누락될 수 있으므로 명시 (W7).
binaries += collect_dynamic_libs('snap7')

hiddenimports += [
    'serial.tools.list_ports',
    'serial.tools.list_ports_posix',
    'snap7',
    'adapters.virtual',
    'adapters.modbus',
    'adapters.phidget',
    'adapters.s7',
    'adapters.kaleido',
    'adapters.probat_ws',
    'extern.atypes',
    'extern.util',
    'extern.async_comm',
    'extern.kaleido',
]

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='sidecar',
    debug=False,
    strip=False,
    upx=False,
    # console=True 유지 필수: tauri-plugin-shell이 CREATE_NO_WINDOW로 스폰하므로
    # 창은 뜨지 않으며, stdout/stderr 드레인(lib.rs)이 이 설정에 의존한다.
    # False(windowed)로 바꾸면 PyInstaller가 sys.stdout/stderr를 None으로 만들어
    # logging.basicConfig 등에서 예외 발생 → 회귀 위험 (W1).
    console=True,
    target_arch=None,  # 빌드 머신 네이티브 아키텍처 사용 (CI 매트릭스에서 aarch64/x86_64 각자 빌드)
    codesign_identity=None,
    entitlements_file=None,
)
