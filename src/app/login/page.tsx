import { entraSsoEnabled } from "@/lib/auth";
import LoginForm from "./LoginForm";

// Server wrapper: the SSO flag comes from env vars, which only exist
// server-side — the client form just receives the boolean.
export default function LoginPage() {
  return <LoginForm ssoEnabled={entraSsoEnabled} />;
}
