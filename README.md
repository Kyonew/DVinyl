![banner dvinyl](./docs/img/banner.png)

--- 

**DVinyl** is a modern, self-hostable music collection manager. It allows you to catalog, value, and manage your Vinyls, CDs, and Cassettes in one interface.

Built in JavaScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Yes-green.svg)](#)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](#)



## Overview

DVinyl allows you to keep track of your physical music collection. It uses the Discogs API to retrieve important metadata and market valuations for your collection. This provides you with a convenient dashboard for your home server.

### ✨ Key Features

* Manage Vinyls, CDs, and Cassettes in a unified library.
* Instant import using Discogs Release IDs.
* Scan your physical media to easily add it to your digital collection*
* Get market estimates (Low/Median/High) for your entire collection.
* Fully localized in English 🇬🇧 and French 🇫🇷.
* Optimized for mobile management with native Dark & Light modes.

*<small>(may only work in France)</small>

## Documentation

To keep things organized, I have split the documentation into specialized guides:

* 🏁 [**Getting Started**](./docs/setup.md) - Manual installation and requirements.
* 🐳 [**Docker Deployment**](./docs/docker.md) - Deploying via Docker Compose *(Recommended)*.
* 🔑 [**API Configuration**](./docs/api-keys.md) - How to obtain your Discogs and Google API keys.

---

## Quick Start (Docker)

If you have Docker and Docker Compose installed, run the following:

```bash
# Clone the repository
git clone [https://github.com/Kyonew/DVinyl.git](https://github.com/Kyonew/DVinyl.git)
cd dvinyl

# Setup environment variables
cp .env.example .env

# Start the containers
docker-compose up -d
```

Access the application at `http://localhost:3099`.

# Tech stack

| **Component**    | **Technology**                 |
| :--------------- | :----------------------------- |
| **Backend**      | Node.js / Express              |
| **Database**     | MongoDB                        |
| **Frontend**     | EJS Templates                  |
| **Styling**      | Tailwind CSS                   |
| **Localization** | i18next                        |
| **API**          | Discogs / Google Custom Search |

# Screenshots

<table width="100%">
  <tr>
    <th width="65%">🖥️ Desktop View</th>
    <th width="35%">📱 Mobile View</th>
  </tr>
  <tr>
    <td align="left" valign="top">
      <a href="./docs/img/desktop-dashboard.jpg">
        <img src="./docs/img/desktop-dashboard.jpg" style="max-height: 320px; width: auto;" alt="Dashboard Desktop">
      </a>
    </td>
    <td align="left" valign="top">
      <a href="./docs/img/mobile-dashboard.png">
        <img src="./docs/img/mobile-dashboard.png" style="max-height: 320px; width: auto;" alt="Dashboard Mobile">
      </a>
    </td>
  </tr>
    <tr>
    <td align="left" valign="top">
      <a href="./docs/img/desktop-collection.jpg">
        <img src="./docs/img/desktop-collection.jpg" style="max-height: 320px; width: auto;" alt="collection Desktop">
      </a>
    </td>
    <td align="left" valign="top">
      <a href="./docs/img/mobile-collection.png">
        <img src="./docs/img/mobile-collection.png" style="max-height: 320px; width: auto;" alt="collection Mobile">
      </a>
    </td>
  </tr>
    <tr>
    <td align="left" valign="top">
      <a href="./docs/img/desktop-detail.jpg">
        <img src="./docs/img/desktop-detail.jpg" style="max-height: 320px; width: auto;" alt="detail Desktop">
      </a>
    </td>
    <td align="left" valign="top">
      <a href="./docs/img/mobile-detail.png">
        <img src="./docs/img/mobile-detail.png" style="max-height: 320px; width: auto;" alt="detail Mobile">
      </a>
    </td>
  </tr>
</table>

# 🤝 Contributing

Honestly, this is my first app of this kind. I am open to any help and advice for this app and my future ones!

If you want to help, you can:

1. Fork the project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

# 📄 License

Distributed under the MIT License. See `LICENSE` for more information.