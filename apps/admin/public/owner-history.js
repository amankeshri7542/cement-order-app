/* global window */
// Register before Next hydrates so unsaved edits can intercept traversal before router cleanup.
window.addEventListener('popstate', (event) => window.shivOwnerBeforePop?.(event), true);
