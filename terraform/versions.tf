terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    # 3.x takes `kubernetes` as an attribute rather than a block - see
    # providers.tf. Dropping to 2.x means converting that back to a block.
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  # Local state on purpose - this is a throwaway test environment. It also
  # means state holds the generated crypto keys in plaintext; see README.

  # backend "azurerm" {
  #   resource_group_name  = "sgbank-tfstate-rg"
  #   storage_account_name = "sgbanktfstate9aaa457b"
  #   container_name       = "tfstate"
  #   key                  = "sgbank-test.tfstate"
  #   use_azuread_auth     = true
  # }
}
