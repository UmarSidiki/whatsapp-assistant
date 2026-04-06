import { Navigate } from "react-router-dom";
import { useSession, type UserRole } from "@/lib/auth-client";

type ProtectedRouteProps = {
  children: React.ReactNode;
  allowedRoles?: readonly UserRole[];
  unauthenticatedRedirectTo?: string;
  unauthorizedRedirectTo?: string;
};

function LoadingState() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export function ProtectedRoute({
  children,
  allowedRoles,
  unauthenticatedRedirectTo = "/",
  unauthorizedRedirectTo = "/dashboard",
}: ProtectedRouteProps) {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return <LoadingState />;
  }

  if (!session) {
    return <Navigate to={unauthenticatedRedirectTo} replace />;
  }

  if (allowedRoles?.length) {
    const role = session.user.role as UserRole | undefined;

    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to={unauthorizedRedirectTo} replace />;
    }
  }

  return <>{children}</>;
}
