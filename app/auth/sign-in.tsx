// Sign-in entry route. The actual UI lives in AuthDoor — one warm
// door, two modes (lumi-auth.jsx). Keeping a dedicated route here
// preserves any existing deep links to /auth/sign-in; the bottom
// toggle inside AuthDoor flips to sign-up in place without
// navigating, so the user never feels the door changed.

import { AuthDoor } from '../../components/auth/AuthDoor';

export default function SignInScreen() {
  return <AuthDoor initialMode="signin" />;
}
