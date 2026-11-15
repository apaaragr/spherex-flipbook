#!/bin/bash
# Retry IRSA TAP every 5 min until each target's SPHEREx image list is saved (2026 approx positions; 0.1° cutouts tolerate a few ").
cd "$(dirname "$0")/.."
T="WISE0855 133.7745 -7.2437
EpsIndB 331.0810 -56.7990
RWAur 76.9564 30.4014
RDra 248.1675 66.7550"
while true; do
  left=0
  while read n ra dec; do
    f="out/${n}_inventory.csv"; [ -s "$f" ] && continue; left=$((left+1))
    q="SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname FROM spherex.artifact a JOIN spherex.plane p ON a.planeid=p.planeid WHERE 1=CONTAINS(POINT('ICRS',$ra,$dec), p.poly) ORDER BY p.time_bounds_lower"
    code=$(curl -s -m 180 -o "$f.tmp" -w "%{http_code}" -G "https://irsa.ipac.caltech.edu/TAP/sync" --data-urlencode "LANG=ADQL" --data-urlencode "FORMAT=csv" --data-urlencode "QUERY=$q")
    if [ "$code" = "200" ] && [ "$(wc -l < "$f.tmp")" -gt 5 ]; then mv "$f.tmp" "$f"; echo "$(date +%H:%M) GOT $n: $(($(wc -l < "$f")-1)) images"; else rm -f "$f.tmp"; echo "$(date +%H:%M) still down for $n (http $code)"; fi
  done <<< "$T"
  [ $left -eq 0 ] && echo "$(date +%H:%M) ALL INVENTORIES SAVED" && exit 0
  sleep 300
done
