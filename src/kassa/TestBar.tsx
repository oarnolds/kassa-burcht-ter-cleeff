/** Above everything else while the kassa runs on Mollie's test key: nothing that is paid by pin here is real. */
export function TestBar() {
  return (
    <div role="status" className="shrink-0 bg-[#F5E7BF] px-4 py-1 text-center text-base text-[#5E4500]">
      <strong className="font-extrabold tracking-wider">TEST</strong> <span>Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.</span>
    </div>
  );
}
