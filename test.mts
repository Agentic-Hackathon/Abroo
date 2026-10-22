const TOKEN = process.env.LIARA_API_TOKEN!;
const TEAM = process.env.LIARA_TEAM_ID!;
const BASE = process.env.LIARA_API_BASE_URL ?? 'https://api.iran.liara.ir';
const APP = process.env.APP!;

const start = Math.floor(Date.now() / 1000) - 30 * 60;
const url = `${BASE}/v2/projects/${APP}/logs?teamID=${TEAM}&start=${start}&direction=forward&last_lines=false`;

const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
const body = await res.text();
console.log('status:', res.status);

try {
  const j = JSON.parse(body);
  const groups = j.data ?? [];
  const lines = groups.flatMap((g: any) => g.values.map((v: any) => ({ rid: g.metaData.releaseId, ts: v[0], raw: v[1] })));
  console.log('groups:', groups.length, 'lines:', lines.length);
  for (const l of lines.slice(-6)) {
    let p: any = {}; try { p = JSON.parse(l.raw); } catch {}
    console.log(l.ts.slice(0, 10), l.rid.slice(-6), p.type, String(p._entry ?? l.raw).slice(0, 90));
  }
} catch {
  console.log(body.slice(0, 300));
}
async function fetchOnce(extra: string) {
  const r = await fetch(
    `${BASE}/v2/projects/${APP}/logs?teamID=${TEAM}&start=${start}&direction=forward${extra}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const j: any = await r.json();
  const ts: number[] = (j.data ?? []).flatMap((g: any) => g.values.map((v: any) => Number(v[0].slice(0, 10))));
  return { status: r.status, n: ts.length, min: Math.min(...ts), max: Math.max(...ts) };
}

console.log('forward    ', await fetchOnce('&last_lines=false'));
console.log('last_lines ', await fetchOnce('&last_lines=true'));
console.log('now (sec)  ', Math.floor(Date.now() / 1000));