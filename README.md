# Calypço Budget

Application de suivi du budget installable sur téléphone. Le code de ce dépôt public ne contient pas de montants personnels, de mot de passe ni de clé privée. Les données sont accessibles après connexion Appwrite et enregistrées dans une ligne privée par utilisateur.

## Développement

```sh
npm ci
npm test
npm run dev
```

## Déploiement GitHub Pages

Le workflow `.github/workflows/pages.yml` publie la branche `main` par GitHub Actions. Dans **Settings → Pages**, choisir **GitHub Actions** comme source.

Adresse visée : `https://tely-hafia.github.io/calypco-budget-site/`.

L'application Appwrite autorise le domaine `tely-hafia.github.io`. Créer le premier compte dans l'écran de connexion avec un nouveau mot de passe, puis importer la sauvegarde JSON du budget dans les réglages.

Les rappels matin, midi et soir se déclenchent lorsque l'application est ouverte. Pour des alertes lorsque l'application est fermée, il reste à installer un fournisseur push et une tâche serveur planifiée.
