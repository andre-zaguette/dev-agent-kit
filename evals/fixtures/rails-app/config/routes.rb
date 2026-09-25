Rails.application.routes.draw do
  resources :notes, only: %i[index]
end
