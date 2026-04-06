import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { GalleryVerticalEnd } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { signIn, useSession } from "@/lib/auth-client";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Redirect if already authenticated
  useEffect(() => {
    if (!isPending && session) navigate("/dashboard", { replace: true });
  }, [session, isPending, navigate]);

  const handleSignIn = async (email: string, password: string) => {
    setLoading(true);
    setError(undefined);
    const { error: authError } = await signIn.email({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message ?? "Failed to sign in");
      return;
    }
    navigate("/dashboard");
  };

  // Show success message passed from SignupPage
  const successMessage = (location.state as { message?: string } | null)?.message;

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
          <div className="w-full max-w-xs space-y-4">
            {successMessage && (
              <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {successMessage}
              </div>
            )}
            <LoginForm onSignIn={handleSignIn} loading={loading} error={error} />
          </div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          src="/placeholder.svg"
          alt="Login cover"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  );
}
