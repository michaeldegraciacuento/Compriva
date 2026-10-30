import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

const login = vi.fn();

vi.mock("../store", () => ({
  useAuthStore: (selector: (state: { login: typeof login }) => unknown) => selector({ login }),
}));

import { LoginForm } from "./login-form";

function fill(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe("LoginForm", () => {
  // Block body: a function returned from beforeEach is run by Vitest as teardown.
  beforeEach(() => {
    login.mockReset();
  });
  afterEach(cleanup);

  it("validates before calling the API", async () => {
    render(<LoginForm onSuccess={vi.fn()} />);

    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!));

    expect(await screen.findByText("Enter your username or email.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it("signs in and continues", async () => {
    const onSuccess = vi.fn();
    login.mockResolvedValue(undefined);
    render(<LoginForm onSuccess={onSuccess} />);

    fill("Username or email", "maria");
    fill("Password", "Secret123");
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith("maria", "Secret123");
  });

  it("shows the server's message for rejected credentials", async () => {
    login.mockRejectedValue(new ApiError({ code: "INVALID_CREDENTIALS", message: "The username or password is incorrect.", status: 401 }));
    render(<LoginForm onSuccess={vi.fn()} />);

    fill("Username or email", "maria");
    fill("Password", "wrong");
    await act(async () => fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!));

    expect(await screen.findByText("The username or password is incorrect.")).toBeTruthy();
  });
});
