import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Action, pageStyles } from '@/components/AppPage';
import { useAuth } from '@/screens/Auth/session';

type Daily = { date: string; exercise_id: string; reps: number | null; clean_share: number | null };
type Progress = { exercise_daily: Daily[]; daily: { day: string; reps: number }[] };
type Insights = { disclaimer: string; insights: { body_part: string; level: string; explanation: string | null }[] };
const ui = pageStyles('Me');
export function SyncedProgress() {
  const auth = useAuth();
  const [data, setData] = useState<{ progress: Progress; insights: Insights } | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const request = useRef(auth.apiFetch);
  useEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
  const fetchLatest = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    try {
      const responses = await Promise.all([request.current('/me/progress?days=49', { signal }), request.current('/me/insights', { signal })]);
      if (responses.some(response => !response.ok)) throw new Error('Could not load your progress. Try refreshing.');
      const [progress, insights] = await Promise.all(responses.map(response => response.json()));
      if (!signal.aborted) { setData({ progress, insights }); setError(null); }
    } catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : 'Could not load progress.'); }
    finally { if (!signal.aborted) setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void fetchLatest(controller.signal);
    const timer = setInterval(() => { void fetchLatest(controller.signal); }, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [fetchLatest]));
  return <View style={{ gap: 10, paddingVertical: 18 }}>
    <Text style={ui.heading}>Training progress</Text>
    {error && <Text accessibilityRole="alert" style={ui.muted}>{error}</Text>}
    <Action secondary disabled={busy} onPress={() => { void fetchLatest(new AbortController().signal); }}>{busy ? 'Loading…' : 'Refresh progress'}</Action>
    {data && <>
      <Text style={ui.muted}>{data.progress.daily.reduce((sum, day) => sum + day.reps, 0)} reps recorded in the last seven weeks.</Text>
      {!data.progress.exercise_daily.length && <Text style={ui.muted}>Your exercise breakdown will appear after processing.</Text>}
      {data.progress.exercise_daily.map(day => <View key={`${day.date}/${day.exercise_id}`} style={{ gap: 4 }}>
        <Text style={ui.text}>{day.date} · {day.exercise_id.replace(/_/g, ' ')} · {day.reps ?? 0} reps</Text>
        <Text style={ui.muted}>Clean reps: {day.clean_share === null ? 'unavailable' : `${Math.round(day.clean_share * 100)}%`}</Text>
      </View>)}
      <Text style={ui.heading}>Form insights</Text>
      {!data.insights.insights.length && <Text style={ui.muted}>No form insights yet.</Text>}
      {data.insights.insights.map(insight => <View key={insight.body_part}><Text style={ui.text}>{insight.body_part.replace(/_/g, ' ')} · {insight.level}</Text><Text style={ui.muted}>{insight.explanation}</Text></View>)}
      <Text style={ui.muted}>{data.insights.disclaimer}</Text>
    </>}
  </View>;
}
