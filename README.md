# Sarah Burger 18 ans

Application web de commande de cheeseburgers pour les 18 ans de Sarah.

Le front est une app React/Vite statique publiable sur GitHub Pages. En production, les commandes passent par Firebase Realtime Database avec Firebase Authentication : les invités sont connectés en anonyme, la cuisine utilise un compte Email/Password autorisé par UID.

## Accès

- Invités : `/#commande`
- Cuisine : `/#stand`

L'URL `#stand` n'est pas une protection. L'accès cuisine est protégé par Firebase Auth et par la liste `kitchenUsers`.

URL GitHub Pages attendue :

```txt
https://VOTRE_USER.github.io/VOTRE_REPO/
```

Si le dépôt s'appelle `sarah-burger-18`, l'URL sera par exemple :

```txt
https://VOTRE_USER.github.io/sarah-burger-18/
```

## Architecture

- `src/services/firebase.js` : initialisation Firebase isolée.
- `src/services/auth.js` : connexion anonyme invité, connexion cuisine Email/Password, vérification UID cuisine.
- `src/services/orders.js` : création, lecture temps réel, mise à jour des statuts, mode local de développement.
- `src/services/session.js` : session `sarah-18-2026`, état réseau Firebase, archivage de session.
- `firebase.rules.json` : règles Realtime Database de production.
- `.github/workflows/deploy.yml` : build Vite puis déploiement officiel GitHub Pages.

Le mode local reste disponible si Firebase n'est pas configuré. Il sert aux tests sur un seul navigateur et ne synchronise pas plusieurs téléphones.

## Assets utilisés

- `sarah-logo.svg` : identité principale.
- `menu-reference.svg` : burger de base.
- `checker.svg` : motif de fond.
- `pickles.svg`, `jalapeno.svg`, `onions.svg` : ajouts.
- `bigmac.svg`, `giant.svg`, `mayo.svg`, `ketchup.svg`, `spicy.svg` : sauces.

Les illustrations originales ne sont pas modifiées.

## Installation locale

```bash
npm install
npm run dev
```

Pour lancer sur le port utilisé par la validation :

```bash
npm run dev -- --port 5178
```

Commandes utiles :

```bash
npm run lint
npm run build
npm run preview
npm run validate
```

`npm run validate` attend l'app sur `http://127.0.0.1:5178/`.

## Variables d'environnement

Créer un fichier `.env.local` depuis `.env.example`.

```env
VITE_GITHUB_PAGES_REPO=sarah-burger-18
VITE_BASE_PATH=/sarah-burger-18/
VITE_EVENT_ID=sarah-18-2026
VITE_EVENT_NAME=18 ans de Sarah
VITE_FIRST_ORDER_NUMBER=18
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Les variables `VITE_FIREBASE_*` sont la configuration publique Web Firebase. Elles ne sont pas des clés administrateur et ne doivent pas donner de droits seules. Les vrais droits sont dans Firebase Authentication et dans `firebase.rules.json`.

`VITE_BASE_PATH` peut être omise en GitHub Actions : le workflow utilise automatiquement le nom du dépôt.

## Configuration Firebase

1. Créer un projet sur Firebase.
2. Ajouter une application Web dans les paramètres du projet.
3. Copier la config Web dans `.env.local` et dans les variables GitHub Actions.
4. Activer Authentication.
5. Activer les fournisseurs :
   - Anonymous ;
   - Email/Password.
6. Créer une Realtime Database en mode verrouillé, pas en mode test.
7. Choisir une région proche, par exemple Europe si disponible.
8. Déployer les règles de `firebase.rules.json`.

Déploiement des règles avec Firebase CLI :

```bash
npm install -g firebase-tools
firebase login
firebase use VOTRE_PROJECT_ID
firebase deploy --only database
```

Alternative : copier le contenu de `firebase.rules.json` dans Firebase Console > Realtime Database > Rules, puis publier.

## Compte cuisine

1. Firebase Console > Authentication > Users.
2. Créer un utilisateur Email/Password, par exemple `cuisine@sarah-burger.local`.
3. Choisir un mot de passe fort et le communiquer uniquement à l'équipe cuisine.
4. Copier l'UID du compte.
5. Dans Realtime Database > Data, ajouter :

```json
{
  "kitchenUsers": {
    "UID_DU_COMPTE_CUISINE": true
  }
}
```

Aucun mot de passe n'est stocké dans le dépôt. Seul l'UID autorisé est en base.

## Règles Firebase

Les règles de `firebase.rules.json` appliquent ces principes :

- aucun accès public complet ;
- invité authentifié anonyme : peut créer une commande dans la session et lire uniquement sa commande directe ;
- cuisine : doit être connectée avec un UID présent dans `kitchenUsers`, peut lire et modifier toutes les commandes ;
- suppression interdite depuis l'app ;
- statuts autorisés : `received`, `preparing`, `ready`, `served`, `cancelled`;
- compteur `lastNumber` incrémenté de `+1` uniquement ;
- session archivée : les invités ne peuvent plus créer de commande.

Les commandes sont stockées sous :

```txt
sessions/sarah-18-2026/orders/{clientRequestId}
```

## Numéros et temps réel

La création de commande :

1. connecte l'invité en anonyme ;
2. vérifie la connexion réseau ;
3. réserve un numéro via transaction atomique sur `meta/lastNumber` ;
4. écrit la commande avec `serverTimestamp()`;
5. affiche l'écran de confirmation seulement après réussite de l'écriture.

Un `clientRequestId` stable empêche les doubles envois par double-clic ou retry. La cuisine reçoit les commandes via abonnement temps réel Realtime Database.

## Déploiement GitHub Pages

1. Pousser le projet sur GitHub.
2. Dans GitHub > Settings > Pages, choisir `GitHub Actions`.
3. Dans GitHub > Settings > Secrets and variables > Actions > Variables, créer :

```txt
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

4. Pousser sur `main`.
5. Le workflow `.github/workflows/deploy.yml` exécute `npm ci`, `npm run build`, puis publie `dist`.

## Procédure de test

Test local sans Firebase :

```bash
npm run dev -- --port 5178
npm run validate
```

Test production avec Firebase :

1. Ouvrir `/#commande` dans deux onglets ou deux téléphones.
2. Envoyer deux commandes presque en même temps.
3. Vérifier dans `/#stand` que les deux numéros sont différents.
4. Passer une commande en mode avion : l'app doit afficher l'état hors ligne et le bouton `Réessayer`.
5. Réactiver le réseau, cliquer `Réessayer`, vérifier que le ticket apparaît seulement après confirmation.
6. Passer une commande en `preparing`, `ready`, `served`, puis tester `cancelled`.
7. Archiver la session depuis la cuisine et vérifier qu'un invité ne peut plus commander.
8. Tester les largeurs 360, 390, 430, 768 et desktop.

## Procédure de secours le jour J

- Garder un ordinateur connecté à `/#stand` et un téléphone test connecté à `/#commande`.
- Si le Wi-Fi tombe, faire patienter les invités : l'app garde le bouton `Réessayer` tant que la commande n'est pas confirmée.
- Si Firebase est indisponible longtemps, passer temporairement en prise de commandes orale avec le tableau cuisine sur un seul appareil en mode local non synchronisé.
- Si la session a été archivée par erreur, retirer ou remettre `false` sur `sessions/sarah-18-2026/meta/archived` depuis Firebase Console avec un compte propriétaire du projet.
- Ne pas repasser la base en mode test.

## Choix techniques

- React + Vite : app statique, légère, publiable sur GitHub Pages.
- Firebase Realtime Database : abonnement temps réel simple pour 50 à 60 invités.
- Firebase Authentication : invités anonymes et cuisine protégée par Email/Password + UID autorisé.
- Realtime Database transaction : numéros de commande réservés sans `orders.length`.
- Fallback localStorage : développement possible sans serveur Node personnel.
