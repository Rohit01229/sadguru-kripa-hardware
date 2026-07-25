// Core is framework-free: enforce the "no React/Next in core" boundary (03 §1).
import base from "@hardware/config/eslint";
import { noReactNextInCore } from "@hardware/config/eslint-boundaries";

export default [...base, noReactNextInCore];
