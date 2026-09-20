from fastapi.routing import APIRoute

from app.main import app
from app.routers.ai import interpret_natural_language
from app.services.ai_contracts import AIResponse


def test_ai_interpret_route_is_registered() -> None:
    routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path == "/api/ai/interpret"
    ]

    assert len(routes) == 1
    route = routes[0]
    assert route.methods == {"POST"}
    assert route.endpoint is interpret_natural_language
    assert route.response_model is AIResponse
    assert route.status_code == 200
    assert "ai" in route.tags
