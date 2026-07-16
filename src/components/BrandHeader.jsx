import { ChefHat, ClipboardList } from "lucide-react";
import { appConfig } from "../services/config";
import { assetPath } from "../data/menu";

export function BrandHeader({ route, setRoute }) {
  const isKitchen = route === "kitchen";

  return (
    <header className="brand-header">
      <button className="brand-home" type="button" onClick={() => setRoute("order")}>
        <img src={assetPath("sarah-logo.svg")} alt="Sarah Burger 18 ans" />
        <span>
          <strong>Sarah Burger</strong>
          <small>{appConfig.eventName}</small>
        </span>
      </button>

      <button
        className="icon-button"
        type="button"
        onClick={() => setRoute(isKitchen ? "order" : "kitchen")}
        aria-label={isKitchen ? "Retour aux commandes" : "Ouvrir le stand"}
      >
        {isKitchen ? <ClipboardList aria-hidden="true" /> : <ChefHat aria-hidden="true" />}
        <span>{isKitchen ? "Commander" : "Stand"}</span>
      </button>
    </header>
  );
}
