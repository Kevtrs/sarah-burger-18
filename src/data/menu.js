export const assetPath = (fileName) => `${import.meta.env.BASE_URL}assets/${fileName}`;

export const baseBurger = ["Pain burger", "Steak haché", "Cheddar"];

export const toppings = [
  {
    id: "pickles",
    label: "Cornichons",
    note: "Croquants et acidulés",
    asset: "pickles.svg",
    accent: "green",
  },
  {
    id: "jalapenos",
    label: "Jalapeños",
    note: "Pour relever le burger",
    asset: "jalapeno.svg",
    accent: "hot",
  },
  {
    id: "onions",
    label: "Oignons frits",
    note: "Dorés et croustillants",
    asset: "onions.svg",
    accent: "gold",
  },
  {
    id: "bacon",
    label: "Bacon",
    note: "Croustillant et fumé",
    asset: "bacon.png",
    accent: "red",
  },
];

export const sauces = [
  {
    id: "bigmac",
    label: "Big Mac maison",
    shortLabel: "Big Mac",
    asset: "bigmac.svg",
    accent: "gold",
  },
  {
    id: "giant",
    label: "Giant maison",
    shortLabel: "Giant",
    asset: "giant.svg",
    accent: "orange",
  },
  {
    id: "mayo",
    label: "Mayonnaise",
    shortLabel: "Mayo",
    asset: "mayo.svg",
    accent: "blue",
  },
  {
    id: "ketchup",
    label: "Ketchup",
    shortLabel: "Ketchup",
    asset: "ketchup.svg",
    accent: "red",
  },
  {
    id: "spicy",
    label: "Sauce piquante maison",
    shortLabel: "Piquante",
    asset: "spicy.svg",
    accent: "hot",
  },
  {
    id: "mustard",
    label: "Moutarde",
    shortLabel: "Moutarde",
    asset: "mustard.png",
    accent: "gold",
  },
];

export const noSauceOption = {
  id: "none",
  label: "Sans sauce",
  shortLabel: "Sans sauce",
};

export const nachosOption = {
  id: "nachos",
  label: "Nachos au cheddar",
  note: "Une portion en accompagnement",
};

export const sauceIds = sauces.map((item) => item.id);

export const statuses = {
  received: {
    label: "Reçue",
    kitchenLabel: "À préparer",
    next: "preparing",
    color: "pink",
  },
  preparing: {
    label: "En préparation",
    kitchenLabel: "En préparation",
    next: "ready",
    color: "gold",
  },
  ready: {
    label: "Prête",
    kitchenLabel: "Prête",
    next: "served",
    color: "green",
  },
  served: {
    label: "Servie",
    kitchenLabel: "Servie",
    next: null,
    color: "blue",
  },
  cancelled: {
    label: "Annulée",
    kitchenLabel: "Annulée",
    next: null,
    color: "red",
  },
};

export const statusOrder = ["received", "preparing", "ready", "served", "cancelled"];

export function getToppingLabels(ids) {
  return ids
    .map((id) => toppings.find((item) => item.id === id)?.label)
    .filter(Boolean);
}

export function normalizeSauceIds(value) {
  if (Array.isArray(value)) {
    const selected = value.filter((id) => sauceIds.includes(id));
    return value.includes(noSauceOption.id) && selected.length === 0 ? [noSauceOption.id] : selected;
  }

  if (typeof value === "string") {
    if (value === noSauceOption.id) return [noSauceOption.id];
    return sauceIds.includes(value) ? [value] : [];
  }

  if (value && typeof value === "object") {
    if (value[noSauceOption.id] === true) return [noSauceOption.id];
    return sauceIds.filter((id) => value[id] === true);
  }

  return [];
}

export function getSauceLabels(value) {
  const ids = normalizeSauceIds(value);
  if (ids.includes(noSauceOption.id)) return [noSauceOption.label];

  return ids
    .map((id) => sauces.find((item) => item.id === id)?.label)
    .filter(Boolean);
}

export function getSauceLabel(value) {
  return getSauceLabels(value).join(", ");
}
