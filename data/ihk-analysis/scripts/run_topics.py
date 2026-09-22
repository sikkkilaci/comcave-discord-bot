import pickle
import re
import os
import json
import collections
from taxonomy import FISI_TOPICS, FIAE_TOPICS, WISO_TOPICS, KQ_TOPICS

BASE = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad'

with open(f'{BASE}/analysis_records.pkl', 'rb') as f:
    records = pickle.load(f)


def fix_year(path):
    """Extract the real exam year from the FILENAME (not the parent folder,
    whose own name like 'FISI 1999 bis 2021' would otherwise be matched first).
    Old-format filenames look like 'CODE - YEAR - N - Season - Type.pdf'; take
    the second ' - '-separated token when it's a plausible year, else fall back
    to the first 1999-2024 match found in the basename alone."""
    base = os.path.basename(path)
    parts = [p.strip() for p in base.split(' - ')]
    for p in parts:
        if re.fullmatch(r'(19|20)\d\d', p):
            y = int(p)
            if 1990 <= y <= 2024:
                return y
    for m in re.finditer(r'(19|20)\d\d', base):
        y = int(m.group(0))
        if 1999 <= y <= 2024:
            return y
    return None


for r in records:
    r['year'] = fix_year(r['path'])


def bucket_of(year):
    if year is None:
        return 'unbekannt'
    if year <= 2005:
        return '1999-2005'
    if year <= 2010:
        return '2006-2010'
    if year <= 2015:
        return '2011-2015'
    if year <= 2020:
        return '2016-2020'
    return '2021-2024 (AO2020)'


def topic_presence(text, patterns):
    low = text.lower()
    return any(re.search(p, low) for p in patterns)


def analyze(group_names, topics, label):
    subset = [r for r in records if r['group'] in group_names]
    result = {
        'label': label,
        'n_documents': len(subset),
        'years_covered': sorted({r['year'] for r in subset if r['year']}),
        'topics': {},
    }
    for topic, patterns in topics.items():
        per_bucket = collections.Counter()
        docs_with_topic = []
        for r in subset:
            if topic_presence(r['text'], patterns):
                per_bucket[bucket_of(r['year'])] += 1
                docs_with_topic.append(r['path'])
        per_bucket_total = collections.Counter(bucket_of(r['year']) for r in subset)
        coverage = {
            b: f'{per_bucket.get(b, 0)}/{per_bucket_total.get(b, 0)}'
            for b in sorted(per_bucket_total.keys())
        }
        result['topics'][topic] = {
            'documents_matching': len(docs_with_topic),
            'coverage_by_period': coverage,
            'example_files': docs_with_topic[:3],
        }
    return result


stufe1_fisi = analyze(['FISI_alt', 'FISI_ao2020'], FISI_TOPICS, 'Stufe 1: FISI historische Gesamtbetrachtung 1999-2024')
stufe2_fisi = analyze(['FISI_ao2020'], FISI_TOPICS, 'Stufe 2: FISI AO2020 Detailanalyse')
stufe2_fiae = analyze(['FIAE_ao2020'], FIAE_TOPICS, 'Stufe 2: FIAE AO2020 Detailanalyse')
stufe2_wiso = analyze(['WISO_ao2020', 'WISO_alt'], WISO_TOPICS, 'Stufe 2: WISO (getrennt behandelt)')
stufe2_kq = analyze(['Kernqualifikationen'], KQ_TOPICS, 'Stufe 2: Kernqualifikationen gemeinsam (AP1 IT-Berufe)')

all_results = {
    'stufe1_fisi_historisch': stufe1_fisi,
    'stufe2_fisi_ao2020': stufe2_fisi,
    'stufe2_fiae_ao2020': stufe2_fiae,
    'stufe2_wiso': stufe2_wiso,
    'stufe2_kernqualifikationen': stufe2_kq,
}

with open(f'{BASE}/topic_results.json', 'w', encoding='utf-8') as f:
    json.dump(all_results, f, ensure_ascii=False, indent=2)

for key, res in all_results.items():
    print(f"\n=== {res['label']} ===")
    print(f"Dokumente: {res['n_documents']}, Jahre: {res['years_covered']}")
    for topic, info in res['topics'].items():
        print(f"  - {topic}: {info['documents_matching']}/{res['n_documents']} Dokumente | {info['coverage_by_period']}")
