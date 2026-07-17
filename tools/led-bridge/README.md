# Sarah Burger — pont panneau LED Windows

Ce programme relie la page `#stand` au panneau LED Bluetooth 32×32.

## Installation

1. Télécharge le dépôt ou cette branche sur le PC du stand.
2. Ouvre `tools/led-bridge`.
3. Double-clique sur `INSTALLER.bat` une seule fois.
4. Double-clique ensuite sur `LANCER.bat` avant d'ouvrir le stand.
5. Laisse la fenêtre noire ouverte.
6. Ouvre `https://kevtrs.github.io/sarah-burger-18/#stand` dans Chrome sur ce même PC.

L'adresse Bluetooth configurée est `6A:0B:5F:BC:79:7B`.

## Affichage

- `received` : numéro + RECU
- `preparing` : numéro + CUIT
- `ready` : numéro + PRET
- `served` : numéro + SERVI
- `cancelled` : numéro + ANNULE

Le pont écoute uniquement sur `127.0.0.1:8765`. Il n'est donc pas accessible depuis Internet ou un autre appareil du réseau.

## Test manuel

Avec `LANCER.bat` ouvert, exécute dans PowerShell :

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/display" `
  -ContentType "application/json" `
  -Body '{"number":27,"status":"ready"}'
```

Le panneau doit afficher la commande 27 comme prête.
