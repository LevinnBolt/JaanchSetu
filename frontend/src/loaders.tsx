// The JaanchSetu loader: a real 3D rupee coin.
// It has actual thickness (a stack of discs forms a reeded edge), an embossed ₹ on the front and "FDR" on the back,
// light that sweeps across each face as it turns, a fixed gold colour (a rupee coin is gold in every theme),
// a gentle tilt and sway, and a shadow that shrinks as the coin rises. No tick or "verified" mark is shown.

const LAYERS = 18;
const THICK = 0.085; // coin thickness as a fraction of its diameter

export function CoinLoader({ size = 170 }: { size?: number }) {
  return (
    <div role="status" aria-label="Loading" className="coin3d-wrap" style={{ ['--c' as string]: `${size}px` }}>
      <div className="coin3d-stage">
        <div className="coin3d-bob">
          <div className="coin3d-tilt">
            <div className="coin3d">
              {Array.from({ length: LAYERS }, (_, i) => (
                <span key={i} className={`coin3d-layer${i % 2 ? ' alt' : ''}`} style={{ transform: `translateZ(calc(var(--c) * ${(THICK * (-0.5 + (i + 0.5) / LAYERS)).toFixed(4)}))` }} />
              ))}
              <div className="coin3d-face coin3d-front" style={{ transform: `translateZ(calc(var(--c) * ${THICK / 2}))` }}>
                <span className="coin3d-sym" aria-hidden="true">₹</span>
                <span className="coin3d-shade coin3d-shade-f" />
              </div>
              <div className="coin3d-face coin3d-back" style={{ transform: `rotateY(180deg) translateZ(calc(var(--c) * ${THICK / 2}))` }}>
                <span className="coin3d-sym coin3d-sym-back" aria-hidden="true">FDR</span>
                <span className="coin3d-shade coin3d-shade-b" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="coin3d-shadow" aria-hidden="true" />
    </div>
  );
}
