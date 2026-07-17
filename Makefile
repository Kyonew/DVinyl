.DEFAULT_GOAL := help
.PHONY: help setup install env dev start typecheck \
        docker-up docker-down docker-build docker-pull docker-update \
        docker-restart docker-logs docker-reset clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

# --- Local (Node.js) ---------------------------------------------------

setup: install env ## Install dependencies and create your .env file

install: ## Install Node dependencies
	npm install

env: ## Create .env from .env.example if it does not exist yet
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example, now fill in your keys")

dev: ## Start DVinyl in the foreground (Node + tsx)
	npm start

start: dev ## Alias for `make dev`

typecheck: ## Type-check the project without emitting files
	npx tsc --noEmit

# --- Docker ------------------------------------------------------------

docker-up: ## Start the containers in the background
	docker compose up -d

docker-down: ## Stop and remove the containers
	docker compose down

docker-build: ## Build the image and start the containers
	docker compose up --build -d

docker-pull: ## Pull the latest pre-built image
	docker compose pull

docker-update: docker-pull docker-up ## Update to the latest image and restart

docker-restart: ## Restart the containers
	docker compose restart

docker-logs: ## Follow the application logs
	docker compose logs -f dvinyl-app

docker-reset: ## Stop everything and delete all local data (this is destructive)
	docker compose down -v

# --- Housekeeping ------------------------------------------------------

clean: ## Remove node_modules
	rm -rf node_modules
