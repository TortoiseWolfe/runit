import { Redirect } from 'expo-router';

import { useSession } from '@/state/hooks';

/** Gate, no UI. */
export default function Index() {
  const session = useSession();
  if (session.kind === 'anonymous') return <Redirect href="/join" />;
  if (session.kind === 'host') return <Redirect href="/host/broadcast" />;
  return <Redirect href="/chat" />;
}
