import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors as c, radius as r, spacing as sp, typography as t } from '@/theme/tokens';
import { MEDAL_LABEL, restCardContent, type PhoneResult, type ServerRestResult } from './restCardContent';

/**
 * The server's result for the set (the POST /sessions/:id/sets response), kept only if it arrives
 * while `resting` is true, so the card never changes after the next set has started.
 */
export function useServerRestResult(request: Promise<ServerRestResult> | null, resting: boolean): ServerRestResult | null {
  const [result, setResult] = useState<ServerRestResult | null>(null);
  const restingNow = useRef(resting);
  useEffect(() => { restingNow.current = resting; }, [resting]);
  useEffect(() => {
    if (!request) return;
    let live = true;
    request.then((r) => { if (live && restingNow.current) setResult(r); }).catch(() => {}); // the phone result stays
    return () => { live = false; };
  }, [request]);
  return result;
}

/**
 * INT-05 / FE-07 rest card: this set's medal and its one rest note. Shows the phone's result at once
 * and the server's (`server`, from useServerRestResult) once it arrives. Not wired into the live set
 * flow yet: that needs the API client (INT-03) and the rest timer (FE-07).
 */
export function RestCard({ phone, server, secondsLeft }: { phone: PhoneResult; server: ServerRestResult | null; secondsLeft?: number }) {
  const content = restCardContent(phone, server, true);
  const medalColor = c[content.medal];
  return <View style={s.card} accessibilityRole="summary" accessibilityLabel={`This set's medal: ${MEDAL_LABEL[content.medal]}. ${content.note}`}>
    <View style={s.row}>
      <View style={[s.medal, { borderColor: medalColor }]}><Text style={[s.medalText, { color: medalColor }]}>{MEDAL_LABEL[content.medal]}</Text></View>
      <Text style={s.caption}>This set’s medal</Text>
      {secondsLeft !== undefined && <Text style={s.timer} accessibilityLabel={`${secondsLeft} seconds of rest left`}>{secondsLeft}s</Text>}
    </View>
    <Text style={s.note}>{content.note}</Text>
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: r.md, padding: sp.md, gap: sp.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  medal: { borderWidth: 2, borderRadius: r.pill, paddingHorizontal: sp.md, paddingVertical: sp.xs },
  medalText: { fontFamily: t.strong, fontSize: t.body },
  caption: { flex: 1, fontFamily: t.label, fontSize: t.caption, color: c.muted },
  timer: { fontFamily: t.display, fontSize: t.subtitle, color: c.text },
  note: { fontFamily: t.family, fontSize: t.body, color: c.text, lineHeight: 24 },
});
