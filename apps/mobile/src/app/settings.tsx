import Screen from '@/screens/Settings';
import { AccountGate } from '@/screens/Auth/AccountGate';
export default function SettingsRoute() { return <AccountGate title="Settings"><Screen /></AccountGate>; }
