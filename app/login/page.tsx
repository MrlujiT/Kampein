import { Notice, readNotice, type SearchParams } from '@/components/ui';
import { signIn, signUp } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold tracking-tight text-brand-700">Kampein</div>
          <p className="mt-2 text-sm text-zinc-500">Run your campaign like an operation.</p>
        </div>
        <Notice {...notice} />
        <form className="card space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" minLength={8} autoComplete="current-password" required />
          </div>
          <div className="flex gap-2">
            <button className="btn flex-1" formAction={signIn}>Sign in</button>
            <button className="btn-ghost flex-1" formAction={signUp}>Create account</button>
          </div>
        </form>
      </div>
    </main>
  );
}
