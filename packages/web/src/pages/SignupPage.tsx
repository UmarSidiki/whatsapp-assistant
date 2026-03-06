import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GalleryVerticalEnd } from "lucide-react";
import { SignupForm } from "@/components/signup-form";
import { useSession } from "@/lib/auth-client";

export default function SignupPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Redirect if already authenticated
  useEffect(() => {
    if (!isPending && session) navigate("/dashboard", { replace: true });
  }, [session, isPending, navigate]);

  const handleSignUp = async (name: string, email: string, password: string, inviteCode: string) => {
    setLoading(true);
    setError(undefined);
    try {
      // Use direct fetch so we can send inviteCode through our server interceptor
      const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
      const res = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password, inviteCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to create account");
        return;
      }
    } catch {
      setError("Network error — please try again");
      return;
    } finally {
      setLoading(false);
    }
    navigate("/", { state: { message: "Account created! Please sign in." } });
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            WhatsApp Bot
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <SignupForm onSignUp={handleSignUp} loading={loading} error={error} />
          </div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          src="/placeholder.svg"
          alt="Signup cover"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  );
}
