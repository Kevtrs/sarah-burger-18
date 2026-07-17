# Sarah Burger LED Bridge

Ce dossier contient le programme Windows qui affiche les commandes Sarah Burger sur le panneau LED Bluetooth 32x32.

Le bridge ne depend plus du navigateur. Il ecoute directement Firebase Realtime Database, puis envoie une image 32x32 au panneau avec `pypixelcolor`.

## 1. A quoi ca sert

Pendant la soiree :

1. les invites commandent sur Sarah Burger ;
2. la cuisine change les statuts dans `/#stand` ;
3. ce programme voit les changements dans Firebase ;
4. le panneau LED affiche le numero de commande.

Affichage :

- `received` : numero + `RECU`
- `preparing` : numero + `CUIT`
- `ready` : numero + `PRET`
- `served` : numero + `SERVI`
- `cancelled` : numero + `ANNULE`

La page web continue de fonctionner meme si le bridge est ferme, si Bluetooth coupe ou si le panneau n'est pas allume.

## 2. Telecharger la bonne branche

Depuis GitHub :

1. ouvrir `https://github.com/Kevtrs/sarah-burger-18` ;
2. choisir la branche `feature/led-panel-bridge` ;
3. cliquer sur `Code` puis `Download ZIP` ;
4. extraire le ZIP sur le PC Windows du stand ;
5. ouvrir le dossier `tools/led-bridge`.

## 3. Installer Python

Installer Python depuis :

```text
https://www.python.org/downloads/windows/
```

Pendant l'installation, cocher :

```text
Add python.exe to PATH
```

Puis fermer et rouvrir l'explorateur Windows.

## 4. Installer le bridge

Dans `tools/led-bridge`, double-cliquer sur :

```text
INSTALLER.bat
```

Le script :

- verifie Python ;
- cree `.venv` ;
- installe les dependances ;
- verifie `pypixelcolor` ;
- cree `config.json` si absent ;
- cree le dossier `assets`.

Il ne supprime pas les fichiers existants.

## 5. Configurer Firebase

Le bridge lit Firebase avec un fichier local secret. Ce fichier ne doit jamais etre pousse sur GitHub.

Dans Firebase Console :

1. ouvrir le projet `sarah-burger-18` ;
2. aller dans `Project settings` ;
3. ouvrir l'onglet `Service accounts` ;
4. cliquer sur `Generate new private key` ;
5. telecharger le fichier JSON ;
6. le renommer exactement :

```text
service-account.json
```

7. le placer dans :

```text
tools/led-bridge/service-account.json
```

Ce fichier est ignore par Git.

## 6. Verifier config.json

Apres `INSTALLER.bat`, ouvrir :

```text
tools/led-bridge/config.json
```

Verifier :

```json
{
  "firebase": {
    "database_url": "https://sarah-burger-18-default-rtdb.europe-west1.firebasedatabase.app",
    "service_account_path": "service-account.json",
    "session_id": "sarah-18-2026"
  },
  "panel": {
    "bluetooth_address": "6A:0B:5F:BC:79:7B",
    "ready_display_seconds": 20,
    "status_display_seconds": 5,
    "reconnect_delay_seconds": 5,
    "brightness": null,
    "idle_gif_path": "assets/idle.gif"
  },
  "behavior": {
    "queue_existing_ready_on_start": false
  },
  "generated_dir": "generated"
}
```

`ready_display_seconds` controle la duree d'affichage d'une commande prete.

## 7. GIF d'attente

Optionnel.

Si tu veux une animation d'attente :

1. creer ou recuperer un GIF deja en `32 x 32` pixels ;
2. le placer ici :

```text
tools/led-bridge/assets/idle.gif
```

Important : le bridge envoie les GIF sans reencodage. Si le GIF ne fait pas deja `32 x 32`, il est refuse pour eviter les animations bloquees ou partielles avec `pypixelcolor`.

Sans GIF, le bridge affiche une image d'attente statique.

## 8. Tester le panneau

Fermer iPixel Color et toute autre application connectee au panneau.

Verifier :

- le panneau est charge ;
- le Bluetooth du PC est active ;
- le panneau n'est pas connecte a un telephone ;
- l'adresse Bluetooth est `6A:0B:5F:BC:79:7B`.

Puis double-cliquer :

```text
TESTER.bat
```

Le panneau doit afficher :

```text
#27 PRET
```

Ce test ne cree aucune vraie commande dans Sarah Burger.

## 9. Lancer le bridge pendant la soiree

Double-cliquer :

```text
LANCER.bat
```

Laisser la fenetre ouverte.

Logs attendus :

```text
[14:32:01] Sarah Burger LED Bridge
[14:32:01] Firebase connecte
[14:32:04] Panneau connecte: 32x32
[14:33:12] Commande #27 -> PRETE
[14:33:14] Image envoyee
```

## 10. Ouvrir la page du stand

Sur le meme PC ou sur un autre appareil autorise :

```text
https://kevtrs.github.io/sarah-burger-18/#stand
```

Connecter le compte cuisine, puis changer les statuts normalement.

Le bridge ecoute Firebase directement. Il detecte donc aussi les changements faits depuis un autre ordinateur ou telephone cuisine.

## 11. File des commandes pretes

Au demarrage, le bridge lit Firebase pour connaitre l'etat actuel.
Il ignore les anciennes commandes servies ou annulees, puis affiche seulement les commandes encore actives.

Quand une commande passe a `ready`, elle est placee dans une file.

Si plusieurs burgers deviennent prets en meme temps :

- chaque numero est affiche ;
- l'ordre d'arrivee est conserve ;
- une commande prete n'est pas perdue ;
- un doublon `ready -> ready` est ignore.

Apres la file, le panneau revient a l'attente ou au prochain etat disponible.

## 12. Si le panneau ne se connecte pas

Verifier :

1. Bluetooth Windows est active ;
2. iPixel Color est ferme ;
3. le panneau n'est pas connecte a un autre appareil ;
4. l'adresse dans `config.json` est correcte ;
5. le panneau est assez charge ;
6. relancer `LANCER.bat`.

Si besoin, supprimer l'appairage Bluetooth Windows du panneau, puis le reconnecter.

## 13. Si Firebase ne repond pas

Verifier :

1. internet fonctionne sur le PC ;
2. `service-account.json` est bien present ;
3. `database_url` est correct ;
4. `session_id` vaut `sarah-18-2026` ;
5. le projet Firebase existe toujours.

Ne mets pas les regles Firebase en mode test.

## 14. Si l'image ne change pas

Verifier :

1. la fenetre `LANCER.bat` affiche des logs ;
2. la commande change bien de statut dans la cuisine ;
3. `TESTER.bat` fonctionne ;
4. le panneau n'est pas connecte a iPixel Color ;
5. le GIF d'attente, s'il existe, fait bien `32 x 32`.

## 15. Arreter proprement

Dans la fenetre du bridge :

```text
Ctrl + C
```

Puis attendre la fermeture. Tu peux aussi fermer la fenetre si necessaire.

## 16. Lancement automatique Windows

Option simple :

1. appuyer sur `Win + R` ;
2. taper `shell:startup` ;
3. creer un raccourci vers `tools/led-bridge/LANCER.bat` ;
4. redemarrer le PC pour tester.

Avant la soiree, verifie quand meme que le bridge se lance bien et que le panneau se connecte.

## Test complet avant la soiree

```text
[ ] Le panneau est charge
[ ] Le Bluetooth du PC est active
[ ] iPixel Color est completement ferme
[ ] Le panneau n'est connecte a aucun telephone
[ ] INSTALLER.bat a ete lance sans erreur
[ ] service-account.json est present
[ ] config.json contient la bonne adresse Bluetooth
[ ] Le GIF d'attente est absent ou deja en 32 x 32
[ ] TESTER.bat affiche #27 PRET
[ ] LANCER.bat affiche Firebase connecte
[ ] Une fausse commande passe de recue a prete
[ ] Le numero apparait sur le panneau
[ ] Le programme redemarre correctement
[ ] La page #stand fonctionne meme si le bridge est ferme
```

## Commandes developpeur

Depuis `tools/led-bridge` :

```bat
.venv\Scripts\python.exe -m unittest discover -s tests
.venv\Scripts\python.exe bridge.py --render-samples --dry-run
.venv\Scripts\python.exe bridge.py --test 27 ready --dry-run
```

## Notes techniques

- Le bridge utilise `google-auth` + REST streaming Firebase, pas Firebase Admin SDK, pour eviter une dependance plus lourde.
- Le navigateur n'appelle plus `127.0.0.1`, donc pas de probleme de mixed content ou de CORS.
- Les PNG generes sont en `32 x 32`.
- Les GIF sont envoyes sans reencodage avec l'API interne de `pypixelcolor 0.4.0`.
- Les secrets locaux sont ignores par Git : `config.json`, `service-account.json`, `.venv`.
