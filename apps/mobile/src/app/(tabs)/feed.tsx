import Screen from '@/screens/Feed';
import { AccountGate } from '@/screens/Auth/AccountGate';
export default function FeedRoute() { return <AccountGate title="Feed"><Screen /></AccountGate>; }
