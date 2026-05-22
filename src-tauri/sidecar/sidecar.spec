# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

for pkg in ('aiohttp', 'multidict', 'yarl', 'aiosignal', 'frozenlist',
            'bleak', 'pymodbus', 'websockets', 'Phidget22'):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

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
    console=True,
    target_arch=None,  # 빌드 머신 네이티브 아키텍처 사용 (CI 매트릭스에서 aarch64/x86_64 각자 빌드)
    codesign_identity=None,
    entitlements_file=None,
)
