## Challenges

- Store a zod form in local storage
- Render Form dynamically based on zod form schema.
- Whenever the form is being submitted/saved, store the data also in local storage.
- Use LLM to regenerate zod form schema based on a user prompt. The users prompt will only be related to single existing field or about a new field, which is missing so far. So the newly generated zod form schema should not have more than 1 changed (or added) field.
- Validate the returned zod form schema, that came from the LLM.
- Check for differences with the returned zod form schema, that came from the LLM, with the previous version (which is currently stored in local storage).
- For every changed field, review the previously stored data from local storage and check if it is still valid for the new form. If valid, just add a success message somewhere. If the the previously stored data is not matching with the new structure, the users will have to find a solution. Therefore, generate a new llm prompt to suggest a solution to the users. The suggest the solution to the user, they can either accept or decline the change for the respective field.
