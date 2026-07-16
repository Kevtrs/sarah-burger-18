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
];

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

export function getSauceLabel(id) {
  return sauces.find((item) => item.id === id)?.label ?? "";
}
