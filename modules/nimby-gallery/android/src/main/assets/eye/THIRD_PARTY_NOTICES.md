# Third-party notices: eye

Eye contains one component licensed by a third party. Its license applies to that component; nothing in the Desert Ant Labs Source-Available License overrides it.

## Image encoder

### PE-Core S/16-384 (Perception Encoder, Meta)
- **Source:** [facebook/PE-Core-S16-384](https://huggingface.co/facebook/PE-Core-S16-384), through the OpenCLIP port [timm/PE-Core-S-16-384](https://huggingface.co/timm/PE-Core-S-16-384) at revision `3249a38eb1c432ec19231c6fe1774acb6a4e4efe`.
- **License:** Apache License 2.0.
- **Use in `eye`:** the image encoder of the `photo`, `photo_peak` and `spatial` functions. Desert Ant Labs fine-tuned some of its blocks (the peak-moment and subject branches), trained every head on top of it, and converted it to Core ML (6-bit palettized weights) and LiteRT (int8 weights).
- **Notice:** Copyright (c) Meta Platforms, Inc. and affiliates. Licensed under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). The weights in this repository are a modified version of the original.

## Desert Ant Labs components

The face detector, face analyzer and sharpness model are trained from scratch by Desert Ant Labs and contain no third-party weights.
