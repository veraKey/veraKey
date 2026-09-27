import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SignInWithVeraKey, VeraKeyProvider, useVeraKey } from "@verakey/sdk/react";

function Shop() {
  const { player, paying, pay } = useVeraKey();
  const [message, setMessage] = useState("");
  if (!player) return <p>Sign in to buy a sword.</p>;
  const buy = async () => {
    try {
      const receipt = await pay({ amount: 1_000_000n }); // 1 USDG to the shop
      const swords = (receipt?.result as { swords?: number } | null)?.swords;
      setMessage(receipt ? `Payment verified: ${receipt.hash.slice(0, 12)}… Swords: ${swords}` : "Payment cancelled.");
    } catch (error) {
      setMessage(`No payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <>
      <p data-testid="player">Player {player.id.slice(0, 10)}…, account {player.account}</p>
      <button type="button" disabled={paying} onClick={buy}>Buy a sword for 1 USDG</button>
      <p data-testid="receipt" role="status">{message}</p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VeraKeyProvider>
      <h1>Sword Shop</h1>
      <SignInWithVeraKey />
      <Shop />
    </VeraKeyProvider>
  </StrictMode>
);
