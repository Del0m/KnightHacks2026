import Screen from '@/screens/Buddies';
import { AccountGate } from '@/screens/Auth/AccountGate';
export default function BuddiesRoute() { return <AccountGate title="Buddies"><Screen /></AccountGate>; }
