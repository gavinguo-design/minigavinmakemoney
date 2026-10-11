# Hang Seng Index constituent version table, 2024-10-01 .. 2026-10-09.
# Each entry: (effective_from, effective_to, codes[]).
# Source: Hang Seng Indexes Company "Index Review Results" quarterly press releases
# (https://www.hsi.com.hk/.../pressRelease/*.pdf, archived via web.archive.org where the
# live hsi.com.hk URL had moved) plus the HSBC-private-placement style ad-hoc deletion
# notice for Hang Seng Bank. Baseline (v1) back-derived from the "before" column of the
# 2024-11-22 review PDF Appendix 1 (82 constituents as of 20 Sep 2024 cutoff).
import json
base = [
"5","939","1299","1398","388","2318","3988","3968","2628","2388","11",
"9988","3690","1211","9618","669","2015","2020","9961","175","27","6690",
"9633","9888","2319","288","66","2313","1928","291","2331","6862","322",
"1044","1876","1929","881","700","1810","981","9999","992","285","883",
"857","1088","1","386","2899","267","2382","1378","868","968","316","941",
"2","6","3","2688","762","836","1038","16","823","1109","1113","688","12",
"1997","960","1209","101","17","2269","1093","1177","6618","1099","241",
"3692","2359",
]
assert len(base) == 82

def apply(codes, add=(), rem=()):
    s = list(codes)
    for a in add:
        if a not in s: s.append(a)
    for r in rem:
        if r in s: s.remove(r)
    return s

v1 = base
v2 = apply(v1, add=["1024","9901"], rem=["17"])                          # eff 2024-12-09, 83
v3 = apply(v2, add=["300","2057"])                                       # eff 2025-06-09, 85
v4 = apply(v3, add=["728","2618","9992"])                                # eff 2025-09-08, 88
v5 = apply(v4, add=["1801"])                                             # eff 2025-12-08, 89
v6 = apply(v5, rem=["11"])                                               # eff 2026-01-15 (HSBC private, ad-hoc), 88
v7 = apply(v6, add=["3750","3993","6181"], rem=["881"])                  # eff 2026-03-09, 90
v8 = apply(v7, add=["1519","2600","6160"])                               # eff 2026-06-08, 93
v9 = apply(v8, add=["1347","2338"])                                      # eff 2026-09-07, 95

VERSIONS = [
    {"effective_from": "2024-10-01", "effective_to": "2024-12-06", "constituent_count": len(v1), "codes": v1,
     "source": "back-derived from Appendix 1 'before' column of 20241122 review PDF (20 Sep 2024 cutoff basis)"},
    {"effective_from": "2024-12-09", "effective_to": "2025-06-06", "constituent_count": len(v2), "codes": v2,
     "source": "hsi.com.hk pressRelease 20241122T174500.pdf: +1024 Kuaishou-W, +9901 New Oriental-S, -17 New World Dev"},
    {"effective_from": "2025-06-09", "effective_to": "2025-09-05", "constituent_count": len(v3), "codes": v3,
     "source": "hsi.com.hk pressRelease 20250516T174501.pdf: +300 Midea-H, +2057 ZTO Express-W"},
    {"effective_from": "2025-09-08", "effective_to": "2025-12-05", "constituent_count": len(v4), "codes": v4,
     "source": "hsi.com.hk pressRelease 20250822T174500.pdf: +728 China Telecom-H, +2618 JD Logistics, +9992 Pop Mart"},
    {"effective_from": "2025-12-08", "effective_to": "2026-01-14", "constituent_count": len(v5), "codes": v5,
     "source": "hsi.com.hk pressRelease 20251121T174500.pdf: +1801 Innovent Biologics"},
    {"effective_from": "2026-01-15", "effective_to": "2026-03-06", "constituent_count": len(v6), "codes": v6,
     "source": "hsi.com.hk indexChgNotice 20251230T170000.pdf: -11 Hang Seng Bank (privatisation delisting, ad-hoc, last trade 2026-01-14)"},
    {"effective_from": "2026-03-09", "effective_to": "2026-06-05", "constituent_count": len(v7), "codes": v7,
     "source": "hsi.com.hk pressRelease 20260213T174500.pdf: +3750 CATL-H, +3993 CMOC-H, +6181 Laopu Gold-H, -881 Zhongsheng Group"},
    {"effective_from": "2026-06-08", "effective_to": "2026-09-04", "constituent_count": len(v8), "codes": v8,
     "source": "hsi.com.hk pressRelease 20260522T174500.pdf: +1519 JT Express-W, +2600 Chalco, +6160 BeiGene"},
    {"effective_from": "2026-09-07", "effective_to": "2026-10-09", "constituent_count": len(v9), "codes": v9,
     "source": "hsi.com.hk pressRelease 20260821 (press_release content PDF): +1347 Hua Hong Semi, +2338 Weichai Power. "
               "Matches investment/chart/hsi-participation.json constituents list (95 names) as of 2026-10-09."},
]

if __name__ == "__main__":
    print(json.dumps(VERSIONS, ensure_ascii=False, indent=1))
