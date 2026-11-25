# Composite War – notes for Claude

## AI art generators: spend free-trial allowances carefully
The owner is using free trials of several pixel-art generators and wants the most out of each.
- Never spend a generation without the owner asking for that specific art. Before a run, say which
  service, how many generations/credits it will use, and what is left. Ask first for more than 3.
- Check the balance (free) before and after spending. Use free cost estimates where a service has them.
- Get the prompt, size and style right before calling. Make one test image and get approval before variations or batches.
- Use the cheapest call that does the job: small sizes, the basic model, no paid extras unless asked.
- Never regenerate something that already exists; check `tools/generator-log.csv` and `assets/` first.
- Log every paid call in `tools/generator-log.csv` (tools/pixellab.py does this automatically).
- API keys live in git-ignored files (e.g. `.pixellab_key`) or environment variables, never in the repo or in js/.

## Generators connected
| Service | Key | Tool | Trial allowance |
|---|---|---|---|
| PixelLab | `.pixellab_key` / `PIXELLAB_API_KEY` | `tools/pixellab.py`, `.mcp.json` | 40 generations (trial, Nov 2026) |
| Retro Diffusion | `.retrodiffusion_key` / `RD_API_KEY` | `tools/retrodiffusion.py` (free price check, spends only with --yes), `.mcp.json` | prepaid USD; rd_fast $0.03/image, rd_lite $0.05 |
