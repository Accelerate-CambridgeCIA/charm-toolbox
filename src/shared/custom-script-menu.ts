// CT-352: the labels of the top-level Custom Script menu, which src/main/menu.ts
// builds by hand (it mixes two Custom Script panel commands with the Python
// Environment and scripting-guide items, so it is not a flat catalog menu).
// Shared so the e2e entry-point router (e2e/support/operations.ts) and the
// menu spec read the same strings without importing electron.

export const CUSTOM_SCRIPT_MENU_LABEL = "Custom Script";
export const PYTHON_ENVIRONMENT_MENU_ITEM_LABEL = "Python Environment...";
export const HOW_TO_WRITE_SCRIPT_MENU_ITEM_LABEL = "How to Write a Custom Script";
export const ENTER_INLINE_FORMULA_MENU_ITEM_LABEL = "Enter Inline Formula";
export const IMPORT_SCRIPT_MENU_ITEM_LABEL = "Import Script...";

// Presentation order, as the client listed it. Separators are not labels.
export const CUSTOM_SCRIPT_MENU_ITEM_LABELS: ReadonlyArray<string> = [
  PYTHON_ENVIRONMENT_MENU_ITEM_LABEL,
  HOW_TO_WRITE_SCRIPT_MENU_ITEM_LABEL,
  ENTER_INLINE_FORMULA_MENU_ITEM_LABEL,
  IMPORT_SCRIPT_MENU_ITEM_LABEL,
];
