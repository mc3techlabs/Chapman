import Image from "next/image";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-chapman-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-chapman-line bg-chapman-panel p-8 shadow-sm">
        <div className="mb-6 text-center">
          <Image
            src="/alpha-phi-alpha-crest.jpg"
            alt="Alpha Phi Alpha Fraternity crest"
            width={840}
            height={806}
            priority
            className="mx-auto mb-3 h-20 w-auto"
          />
          <h1 className="text-lg font-extrabold text-chapman-ink">
            Chapman Reporting Portal
          </h1>
          <p className="mt-1 text-sm text-chapman-muted">
            Alpha Phi Alpha Fraternity, Inc.
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-chapman-muted">
          Chapters sign in with the shared chapter account. Reviewers sign in
          with their individual named account.
        </p>
      </div>
    </main>
  );
}
