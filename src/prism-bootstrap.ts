import Prism from "prismjs";

// MDXEditor's production bundle contains a legacy module that reads Prism as
// a browser global during module evaluation. Keep this as a separate HTML
// entry so it finishes before the main application module starts.
(globalThis as typeof globalThis & { Prism: typeof Prism }).Prism = Prism;
