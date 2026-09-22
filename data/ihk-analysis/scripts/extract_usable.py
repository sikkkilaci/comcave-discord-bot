import subprocess
import os
import json

ROOT = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad/ihk/ihk_pruefungen'
CLASSIFICATION = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad/classification.json'
OUT_DIR = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad/extracted_text'
os.makedirs(OUT_DIR, exist_ok=True)


def is_filename_echo(txt: str) -> bool:
    stripped = txt.replace('\n', '').replace('\x0c', '').strip().lower()
    return stripped.startswith(('fisi_', 'wiso_', 'fae_')) and len(set(stripped.split('.pdf'))) <= 2


def extract_full_text(path: str) -> str:
    r = subprocess.run(['pdftotext', '-q', path, '-'], capture_output=True, timeout=60, text=True, errors='replace')
    return r.stdout or ''


def is_usable(txt_first5: str) -> bool:
    stripped = txt_first5.strip()
    return len(stripped) >= 100 and not is_filename_echo(stripped)


with open(CLASSIFICATION, encoding='utf-8') as f:
    data = json.load(f)

groups = {
    'FISI_alt': [p for p in data['results']['Systemintegration'] if p.startswith('FISI 1999')],
    'FISI_ao2020': [p for p in data['results']['Systemintegration'] if not p.startswith('FISI 1999')],
    'FIAE_alt': [p for p in data['results']['Anwendungsentwicklung'] if p.startswith('FAE 1999')],
    'FIAE_ao2020': [p for p in data['results']['Anwendungsentwicklung'] if not p.startswith('FAE 1999')],
    'WISO_ao2020': data['results']['WISO'],
    'Kernqualifikationen': data['results']['Kernqualifikationen (gemeinsam)'],
}

manifest = {}
for group, paths in groups.items():
    manifest[group] = {'usable': [], 'scanned_excluded': []}
    for rel in paths:
        full = os.path.join(ROOT, rel)
        r5 = subprocess.run(['pdftotext', '-l', '5', '-q', full, '-'], capture_output=True, timeout=30, text=True, errors='replace')
        if is_usable(r5.stdout):
            text = extract_full_text(full)
            safe_name = f'{group}__{len(manifest[group]["usable"])}.txt'
            with open(os.path.join(OUT_DIR, safe_name), 'w', encoding='utf-8') as out:
                out.write(text)
            manifest[group]['usable'].append({'path': rel, 'text_file': safe_name, 'chars': len(text)})
        else:
            manifest[group]['scanned_excluded'].append(rel)

for group, info in manifest.items():
    print(f"{group}: usable={len(info['usable'])} excluded_scanned={len(info['scanned_excluded'])}")

with open(os.path.join(OUT_DIR, '_manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print('Manifest geschrieben.')
