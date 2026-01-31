# 🏁 Getting Started (Manual Setup)

This guide will walk you through setting up **DVinyl** on your local machine or server using Node.js and MongoDB.

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
* **Node.js** (v18.x or higher)
* **npm** or **yarn**
* **MongoDB** (v6.x or higher)

## 🛠️ Installation Steps

### 1. Clone the Repository
```bash
git clone https://github.com/Kyonew/DVinyl.git
cd dvinyl
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the template and fill in your details (see [API Configuration](./api-keys.md) for keys):

```bash
cp .env.example .env
```

>![IMPORTANT]
> Make sure to use `PROD=true` **ONLY WITH HTTP<u>S</u>**. For localhost or local IP access, leave `PROD` to `false`.
> For the environment variables `PASSJWT` and `SESSION_SECRET`, make sure to use different complex passwords. They are essential for properly **encrypting** sessions.

### 4. Launch the Application

```bash
npm start app.js
```

You can also run the app with **pm2**:

```bash
pm2 start app.js --name dvinyl
```

DVinyl should now be running at http://localhost:3099.

[← Back to README](../README.md)  
[See Docker installation →](./docker.md)
