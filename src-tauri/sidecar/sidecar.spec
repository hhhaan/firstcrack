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
    'extern.simulator',
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
    target_arch='arm64',
    codesign_identity=None,
    entitlements_file=None,
)
