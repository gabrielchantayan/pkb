package gmail

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/gmail/v1"
	"google.golang.org/api/option"
)

// createGmailService creates a Gmail service using stored OAuth credentials
func createGmailService(credentialsPath, tokenPath string) (*gmail.Service, error) {
	ctx := context.Background()

	// Read credentials file
	credBytes, err := os.ReadFile(credentialsPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read credentials file: %w", err)
	}

	config, err := google.ConfigFromJSON(credBytes, gmail.GmailReadonlyScope)
	if err != nil {
		return nil, fmt.Errorf("unable to parse credentials: %w", err)
	}

	// Read token file
	token, err := tokenFromFile(tokenPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read token file (run 'pkb-daemon oauth gmail' to authenticate): %w", err)
	}

	client := config.Client(ctx, token)
	service, err := gmail.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("unable to create Gmail service: %w", err)
	}

	return service, nil
}

// tokenFromFile reads a token from a file
func tokenFromFile(path string) (*oauth2.Token, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	token := &oauth2.Token{}
	err = json.NewDecoder(f).Decode(token)
	return token, err
}

// saveToken saves a token to a file
func saveToken(path string, token *oauth2.Token) error {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()

	return json.NewEncoder(f).Encode(token)
}

// OAuthFlow handles the interactive OAuth flow for Gmail
// This is called from the CLI when setting up a new Gmail account
func OAuthFlow(credentialsPath, tokenPath string) error {
	ctx := context.Background()

	credBytes, err := os.ReadFile(credentialsPath)
	if err != nil {
		return fmt.Errorf("unable to read credentials file: %w", err)
	}

	config, err := google.ConfigFromJSON(credBytes, gmail.GmailReadonlyScope)
	if err != nil {
		return fmt.Errorf("unable to parse credentials: %w", err)
	}

	// Start local server for callback
	codeChan := make(chan string)
	errChan := make(chan error)

	server := &http.Server{Addr: ":8085"}
	http.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		if code == "" {
			errChan <- fmt.Errorf("no code in callback")
			return
		}
		codeChan <- code
		fmt.Fprintf(w, "Authorization successful! You can close this window.")
	})

	go func() {
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			errChan <- err
		}
	}()

	// Generate auth URL
	config.RedirectURL = "http://localhost:8085/callback"
	authURL := config.AuthCodeURL("state-token", oauth2.AccessTypeOffline)

	fmt.Printf("Open this URL in your browser to authorize:\n\n%s\n\n", authURL)
	fmt.Println("Waiting for authorization...")

	var code string
	select {
	case code = <-codeChan:
	case err := <-errChan:
		server.Shutdown(ctx)
		return err
	}

	server.Shutdown(ctx)

	// Exchange code for token
	token, err := config.Exchange(ctx, code)
	if err != nil {
		return fmt.Errorf("unable to exchange code for token: %w", err)
	}

	// Save token
	if err := saveToken(tokenPath, token); err != nil {
		return fmt.Errorf("unable to save token: %w", err)
	}

	fmt.Printf("Token saved to %s\n", tokenPath)
	return nil
}
