export function LegalPage({ title, sections }: { title: string; sections: [string, string][] }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="mt-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
        مسودة أولية — قيد المراجعة القانونية.
      </p>
      <div className="mt-10 space-y-8">
        {sections.map(([heading, body]) => (
          <section key={heading}>
            <h2 className="text-xl font-semibold">{heading}</h2>
            <p className="mt-2 leading-8 text-muted">{body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
