"""Verify a compiled Zepp bundle without executing it; no hardware claims."""
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile

path = Path(sys.argv[1])
source = json.loads(Path('app.json').read_text())
expected_sources = {9765120, 9765121, 10158337}
expected_pages = set(source['targets']['bip6']['module']['page']['pages'])
with zipfile.ZipFile(path) as bundle:
    manifest = json.loads(bundle.read('manifest.json'))
    assert manifest['bundleInfo']['zpm'] == '3.1.5'
    assert len(manifest['zpks']) == 1
    target = manifest['zpks'][0]
    assert {entry['deviceSource'] for entry in target['platforms']} == expected_sources
    zpk = bundle.read(target['name'])
    assert hashlib.md5(zpk).hexdigest() == target['md5']
    with zipfile.ZipFile(io.BytesIO(zpk)) as package:
        assert set(package.namelist()) == {'device.zip', 'app-side.zip'}
        with zipfile.ZipFile(io.BytesIO(package.read('device.zip'))) as device:
            config = json.loads(device.read('app.json'))
            assert config['app']['appId'] == source['app']['appId']
            assert config['app']['version']['name'] == '0.1.0'
            assert config['runtime']['type'] == 2
            assert config['runtime']['apiVersion']['minVersion'] == '4.2'
            assert config['designWidth'] == 390
            assert config['permissions'] == source['permissions']
            assert {entry['deviceSource'] for entry in config['platforms']} == expected_sources
            assert set(config['module']['page']['pages']) == expected_pages
            expected_bins = {'app.bin'} | {page + '.bin' for page in expected_pages}
            assert {name for name in device.namelist() if name.endswith('.bin')} == expected_bins
            assert len(device.read('assets/icon.png')) > 0
            for name in device.namelist():
                assert not name.startswith(('tests/', 'docs/', 'scripts/', '.git/', 'node_modules/'))
                content = device.read(name)
                for forbidden in [b'api.todoist.com', b'pulso.token', b'Bearer ', b'SIMULATED_', b'node:test']:
                    assert forbidden not in content, (name, forbidden)
        with zipfile.ZipFile(io.BytesIO(package.read('app-side.zip'))) as phone:
            assert set(phone.namelist()) == {'app-side.js', 'setting.js', 'app.json'}
            assert b'api.todoist.com' in phone.read('app-side.js')
            assert b'pulso.token' in phone.read('setting.js')
            for name in phone.namelist():
                assert b'SIMULATED_' not in phone.read(name)
                assert b'node:test' not in phone.read(name)
print(f'Pacote verificado: {path.name}; {path.stat().st_size} bytes; SHA-256 {hashlib.sha256(path.read_bytes()).hexdigest()}')
print('ZAB/ZPK integrity, Bip 6 variants, API 4.2, binary loader, production-only files and token isolation: OK')
