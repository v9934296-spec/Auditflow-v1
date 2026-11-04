export const metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <article className="mx-auto max-w-[70ch] space-y-4 px-5 py-16">
      <h1 className="text-4xl font-extrabold">Terms of Service</h1>
      <p className="text-sm text-ink-soft">Template. Have it reviewed by a lawyer in your jurisdiction before launch, and set the effective date.</p>
      <h2 className="pt-4 text-xl font-bold">The service</h2>
      <p>Ventriva Audit performs automated static analysis of source code you authorize us to read and produces reports, scores and suggested fixes. It is an engineering aid. It is not a penetration test, a certification, a legal or compliance opinion, or a guarantee that your software is secure or fit for any purpose.</p>
      <h2 className="pt-4 text-xl font-bold">Your responsibilities</h2>
      <p>You must have the right to grant us access to every repository you connect. You remain responsible for reviewing and testing any change you make based on our reports.</p>
      <h2 className="pt-4 text-xl font-bold">Payments and refunds</h2>
      <p>Full audits are one-time purchases that grant one audit credit. Pro is billed monthly until cancelled from the billing portal; access continues to the end of the paid period. If an audit fails for a system reason, the credit is returned automatically.</p>
      <h2 className="pt-4 text-xl font-bold">Acceptable use</h2>
      <p>Do not use the service to analyze code you are not authorized to access, to probe our systems, or to resell results as a certification.</p>
      <h2 className="pt-4 text-xl font-bold">Liability</h2>
      <p>To the maximum extent permitted by law, the service is provided &ldquo;as is&rdquo; and our total liability is limited to the amount you paid in the twelve months before the claim.</p>
      <h2 className="pt-4 text-xl font-bold">Changes</h2>
      <p>We will notify you by email of material changes at least 14 days before they take effect.</p>
    </article>
  );
}
