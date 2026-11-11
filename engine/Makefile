.PHONY: dev test fmt run docker keygen

dev:          ## install everything needed to run locally
	pip install -e ".[media,dev]"

run:          ## start the Engine on :8080
	uvicorn app.main:app --reload --port 8080

test:         ## the full suite; no model weights or API keys needed
	python -m pytest -q

docker:       ## build and start the container
	docker compose up -d --build

keygen:       ## print a strong API key and webhook secret
	@python -c "import secrets;print('ENGINE_API_KEYS='+secrets.token_urlsafe(36));print('WEBHOOK_SECRET='+secrets.token_urlsafe(36))"
