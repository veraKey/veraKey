import { Copy, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { useVeraKey } from "@/state/VeraKeyProvider";

/** EIP-681 request for USDG to `account`; wallets that scan it prefill a token transfer. */
function usdgRequest(usdg: string, chainId: number, account: string) {
  return `ethereum:${usdg}@${chainId}/transfer?address=${account}`;
}

/** Where to send USDG so it lands in this app's account without linking it to your other accounts. */
export function ReceivePanel({ account, onClose }: { account: Address; onClose?: () => void }) {
  const { config } = useVeraKey();
  const [svg, setSvg] = useState("");
  const uri = config ? usdgRequest(config.contracts.usdg, config.chainId, account) : "";
  useEffect(() => {
    if (uri) QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#0d1117", light: "#f3f7ee" } }).then(setSvg);
  }, [uri]);
  return (
    <div className="vk-receive">
      <div className="vk-receive-head">
        <b>Receive USDG</b>
        {onClose && (
          <button className="vk-btn vk-btn-quiet" aria-label="Close" onClick={onClose}><X size={14} /></button>
        )}
      </div>
      <div className="vk-receive-body">
        <div className="vk-qr" aria-label="QR code with an EIP-681 USDG payment request" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="vk-receive-copy">
          <code className="vk-mono">{account}</code>
          <button className="vk-btn vk-btn-ghost" onClick={() => navigator.clipboard.writeText(account).then(() => toast("Address copied"))}>
            <Copy size={13} /> Copy address
          </button>
          <p>
            USDG on {config?.chainName}. Have a payer, an employer or an exchange withdrawal send here directly.
            Topping up every app account from one wallet links them on-chain; on mainnet, route top-ups through a
            privacy pool (0xbow Privacy Pools or Railgun on Arbitrum One). No privacy pool runs on Arbitrum Sepolia.
          </p>
        </div>
      </div>
    </div>
  );
}
