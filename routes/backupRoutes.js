const express = require('express');
const router = express.Router();
const Album = require('../models/Album');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = {
            users: await User.find({}).lean(),
            albums: await Album.find({}).lean(),
            logs: await LoginLog.find({}).lean(),
            metadata: {
                version: "1.0.0",
                date: new Date()
            }
        };
        
        const fileName = `dvinyl_backup_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
        res.status(500).send("Export failed");
    }
});

router.post('/import', async (req, res) => {
    try {
        // On essaie de récupérer les données peu importe le format d'envoi
        let data = req.body;
        
        // Si les données arrivent dans une clé "backupData" (comme parfois en admin)
        if (data.backupData) {
            data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
        }

        if (!data || !data.users) {
            console.log("❌ Données reçues invalides :", Object.keys(req.body));
            return res.status(400).json({ error: "Format de backup invalide" });
        }

        console.log(`📦 Importation en cours : ${data.albums?.length || 0} albums trouvés.`);

        // Nettoyage complet (Ordre : logs -> albums -> users)
        await Promise.all([
            LoginLog.deleteMany({}),
            Album.deleteMany({}),
            User.deleteMany({})
        ]);

        // Insertion des données
        if (data.users && data.users.length > 0) await User.insertMany(data.users);
        if (data.albums && data.albums.length > 0) await Album.insertMany(data.albums);
        if (data.logs && data.logs.length > 0) await LoginLog.insertMany(data.logs);

        console.log("✅ Base de données restaurée avec succès.");

        // On vide le cookie JWT pour forcer une nouvelle connexion propre
        res.cookie('jwt', '', { maxAge: 1 });
        res.status(200).json({ success: true });

    } catch (err) {
        console.error("🔥 Erreur Import Backup :", err);
        res.status(500).json({ error: "Erreur interne lors de l'import" });
    }
});


module.exports = router;