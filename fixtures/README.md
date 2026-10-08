# Fixtures

The tests run the SDK against the real program in [LiteSVM](https://github.com/LiteSVM/litesvm), not a mock.

| File | What it is |
| --- | --- |
| `helix.so` | The HELIX program, byte for byte as deployed on mainnet at `HLX49qz3CSKQrHrdzrrWygZBaKHWWSG8JwUMFHcZ47Fr`. |
| `example_hook.so` | `trade_tax`, the example external hook the tests use. Not deployed on mainnet. |

Check `helix.so` against mainnet yourself:

```sh
solana program dump HLX49qz3CSKQrHrdzrrWygZBaKHWWSG8JwUMFHcZ47Fr mainnet.so -u mainnet-beta
shasum -a 256 mainnet.so fixtures/helix.so
# c688c98d674233ded73adecc4e0e1bfa072d55b4cdfb6119538d9f153ffab50b  (both)
```
